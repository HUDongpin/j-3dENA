# 2026-08-20 — Next.js/jENA feasibility and agent execution record

## Record metadata

| Field | Value |
|---|---|
| Date | 2026-08-20 |
| Time zone | Asia/Taipei |
| Codex task/thread | `01a01dfa-555b-7fd0-bfa3-34ac76b2ddd9` |
| Project workspace | `/Volumes/WestWorld/j-3dENA` |
| Record status | Recorded context; confirmed decisions are in section 2; implementation not started |
| Scope | Feasibility, architecture, parity boundary, risks, and agent-native execution schedule |

This document is the durable project record of the originating Codex session.
It separates confirmed user decisions, verified audit observations,
recommendations, unresolved gates, and time estimates. It is not evidence that
the Next.js application has already been implemented.

At the time this record was created, the workspace was not a Git repository and
contained no application source. It contained an existing design-system file at
`design-system/3dena-next/MASTER.md`; this record, `AGENTS.md`, and `README.md`
were added without altering that design-system file.

During the completion audit, a separate concurrent initialization added the
current root `package.json`, `.npmrc`, `.gitignore`, `tsconfig.base.json`, and
`LICENSE`. Those files were preserved rather than overwritten. They currently
select:

- npm workspaces under `apps/*` and `packages/*`;
- Node `>=20.9.0`;
- strict TypeScript settings;
- `GPL-3.0-only` project/package metadata;
- root scripts for lint, typecheck, unit, golden, build, browser, accessibility,
  and production-runtime-boundary checks.

The existence of that foundation still does not prove an implemented
application. No attribution was inferred for the concurrent files solely from
their presence.

## 中文摘要

- 项目目标是用 Next.js、React、TypeScript 和 `jena-js` 重建 3DENA 的数据
  分析能力，而不是只复制 Shiny 界面。
- 最终生产环境必须完全不依赖 R、rENA、Shiny 或隐藏的 R 服务。
- 用户已明确批准开发和验证阶段运行冻结的 R/rENA，作为只读 scientific
  oracle；它可以生成 golden、做 differential testing，但不能进入生产依赖。
- 技术结论为“有条件可行”。jENA 足以作为 ENA 数值核心，但 Stats、centroid
  trajectory、bootstrap、3D Plotly、导入导出、worker 生命周期和生产验收仍需
  用 TypeScript 完整实现。
- 当前根项目已选择 npm workspaces、Node `>=20.9.0`、strict TypeScript 和
  `GPL-3.0-only`；发布前仍需完成完整许可证文本、第三方 notice 和衍生代码合规
  审查。
- 工期按 4 个 Sol 5.6 Ultra agents、每天连续 24 小时计算：Calibration 为
  2/4 天（P50/P80），内部 Beta 为 7/12 天，当前公开功能 parity 为 16/30
  天，生产替换为 30/45 天，严格全仓 parity 为 45/70 天。
- “文件已经写出”不等于完成；每个里程碑必须通过相应的 R oracle、数值、真实
  浏览器、下载、安全、worker、性能、soak 和发布证据。
- 本文记录的是项目决策和执行基线，不代表 Next.js 应用已经完成。

## 1. Originating request

The current 3DENA product is based on R, Shiny, and rENA:

- public site: [www.3dena.com](https://www.3dena.com/);
- legacy repository: [HUDongpin/3DENA](https://github.com/HUDongpin/3DENA).

jENA is available as a GitHub repository and npm package:

- repository: [HUDongpin/jENA](https://github.com/HUDongpin/jENA);
- package: [jena-js on npm](https://www.npmjs.com/package/jena-js).

The requested product is a 3DENA successor whose analysis runtime is written in
the Next.js/JavaScript/TypeScript ecosystem and obtains the same scientifically
meaningful analysis effects using jENA instead of a production R/rENA runtime.

The session was asked to determine:

1. whether that objective is feasible;
2. what jENA already supplies and what must be rebuilt;
3. what architecture and acceptance conditions are required;
4. how long four Sol 5.6 Ultra agents would take when measured as continuous
   agent work rather than traditional human engineering weeks.

## 2. Confirmed user decisions

### D-001 — Pure JavaScript/TypeScript production runtime

The target production application must not require R, rENA, Shiny, Shiny
Server, an R subprocess, or R packages. It may use Next.js, React, TypeScript,
`jena-js`, browser APIs, Web Workers, Plotly, and a Node/Next server route where
appropriate.

“Completely Next.js” means a Next.js product whose scientific modules are pure,
reusable TypeScript. It does not mean that CPU-intensive algorithms belong in
React components or short-lived serverless request handlers.

### D-002 — R/rENA is allowed during development and validation

The user explicitly confirmed:

> 开发验证阶段允许运行 R/rENA

Accordingly, the frozen R/rENA implementation may be run as a read-only
scientific oracle to generate goldens, characterize legacy behavior, and verify
the TypeScript successor. It must not be part of the production dependency
graph or deployment.

This decision preserves the strongest available scientific evidence chain and
removes the previously discussed 3–7 day risk increment associated with
forbidding the oracle during migration.

### D-003 — Schedule is measured in agent-native time

The user rejected traditional human-team week estimates as the primary project
schedule. The active estimate therefore uses:

- four concurrent `gpt-5.6-sol Ultra` agents;
- continuous 24-hour natural days;
- total agent-hours plus actual critical-path wall-clock;
- no conversion from human developer weeks;
- external human approval waiting reported separately.

The earlier 8–18 human-project-week estimates are superseded for agent execution
planning by the schedule in section 11. They remain useful only as a comparison
with conventional team planning.

## 3. Feasibility verdict

**Verdict: Conditional GO.**

The target is technically feasible with a production runtime containing no
R/rENA. jENA is mature enough to serve as the ENA numerical core. The project is
not a UI translation: substantial TypeScript work is required for 3D product
views, statistics, centroid trajectory analysis, bootstrap and comparisons,
safe import/export, worker lifecycle, AI evidence boundaries, and production
verification.

The conditions are:

1. freeze and verify the legacy scientific baseline;
2. preserve the selected GPL-3.0-only direction and complete release-compliance
   review and notices;
3. define semantic parity and approved numerical tolerances;
4. preserve typed identity and longitudinal shared-space semantics;
5. use real worker cancellation and stale-result ownership;
6. pass numerical, browser, security, performance, export, and release gates.

Scientifically equivalent behavior is feasible. Undefined bit-for-bit identity
between R/LAPACK and JavaScript numerical implementations should not be promised
without separately implementing the relevant compatibility semantics.

## 4. Audited source snapshots

### Legacy 3DENA

The audit was bound to:

- commit
  [`d02019ad872c5ece3840be2b4028ef27af38b2ff`](https://github.com/HUDongpin/3DENA/commit/d02019ad872c5ece3840be2b4028ef27af38b2ff),
  dated 2026-08-19;
- R 4.4.1;
- rENA 0.2.7.

Observed scale in that snapshot included approximately:

- 25,720 lines in the R source tree;
- 14,032 lines of testthat source and roughly 340 `test_that` blocks;
- about 9,000 R lines across trajectory analysis, trajectory module, and
  trajectory plotting alone.

The latest main CI run inspected for that commit was
[cancelled during R system-dependency installation](https://github.com/HUDongpin/3DENA/actions/runs/32227352792).
It was not a demonstrated test failure, but it also was not green evidence for
the exact current main commit. Calibration must rerun and freeze the baseline.

The audited raw-data construction path still invoked `rENA::ena()`. The site's
“jENA / PARITY for rENA” language was not evidence that jENA had already been
integrated into the current application.

The public health document reported the same build lineage together with:

- `runtime_profile: "ephemeral-preview"`;
- `connection_policy: "reload-required"`;
- `ai_enabled: false`.

See the [live health document](https://www.3dena.com/ena3d-health/healthz.json).
The browser audit successfully loaded the Class 1 sample and ran trajectory and
statistics, while an independent run also observed the structural session-end
boundary. A browser-local worker architecture can remove the need to reproduce
Shiny's stateful WebSocket session model.

### jENA

The audit was bound to:

- commit
  [`2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3`](https://github.com/HUDongpin/jENA/commit/2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3);
- npm version `jena-js@0.6.2`;
- GPL-3.0-only as declared by its package metadata;
- Node 18 or newer.

The session directly verified at that snapshot:

- 150 Node tests passing;
- 4 Chromium browser tests passing;
- lint passing;
- typecheck passing;
- package/pack validation passing;
- current [jENA CI](https://github.com/HUDongpin/jENA/actions/runs/29169750400)
  passing;
- a local benchmark of about 734 ms for 20 codes by 5,000 rows, about
  538 ms for a 190 by 190 eigensolve, and about 429 ms for the audited
  correlation workload on the audit machine.

The published `package.json` also declared a dependency on itself,
`"jena-js": "^0.6.0"`, contrary to the intended zero-runtime-dependency model.
A successor package should remove that self-dependency and prove a fresh Next.js
consumer build before production use.

Additional integration boundaries verified during the session:

- the package is ESM-only and declares Node 18 or newer;
- stable public exports should be consumed behind the new adapter, while
  `jena-js/experimental` is not a stable product contract;
- an existing Next.js 16.2.9 consumer proved a module-Worker path with
  `next build --webpack`;
- the current browser evidence was Chromium, not a proof of Firefox, WebKit, or
  Safari support;
- arbitrary custom weighting functions are not structured-cloneable worker
  messages and require a serializable approved-function contract;
- the current synchronous model/SVD work cannot be assumed to support
  cooperative mid-compute cancellation, so the product supervisor must be able
  to terminate and rebuild a worker.

## 5. What jENA covers and what remains

| Capability | jENA snapshot | Required successor work |
|---|---|---|
| EndPoint, AccumulatedTrajectory, SeparateTrajectory | Substantially covered | Validated 3DENA adapter and goldens |
| Moving Stanza and Conversation windows | Covered | Product mapping and edge cases |
| Binary/sum accumulation, sphere, centering | Covered | Contract and input validation |
| SVD, Means, shared projection | Covered | Sign/subspace parity and product orchestration |
| Worker entry | Basic support | Supervisor, pool, cancellation, deadline, ownership |
| Plot adapter | 2D/basic | Full Plotly 2D/3D product compiler |
| Statistics | Partial | p values, CIs, effects, rank-sum, signed-rank, pairing, adjustments |
| Raw and prepared-data import | Not a 3DENA product layer | CSV/Excel/exchange/security/transactionality |
| Centroid trajectory analysis | Not covered | Full TypeScript subsystem |
| Cluster bootstrap and path comparisons | Not covered | Full TypeScript subsystem |
| Confidence boxes and network overlay | Not covered | Plotly geometry and semantic tests |
| CSV/ZIP/manifest/provenance | Not covered | Safe versioned export subsystem |
| AI evidence/consent/governance | Not covered | Optional default-off Next server boundary |
| Product routes/state/a11y/release | Not covered | Next.js product and release evidence |

Important naming distinction: jENA's `AccumulatedTrajectory` and
`SeparateTrajectory` are accumulation models. They are not the existing 3DENA
centroid trajectory analysis with cohorts, distances, speeds, bootstrap,
comparisons, diagnostics, overlays, and formal downloads.

An open jENA issue also records a small tied-data Spearman discrepancy. It does
not by itself block the current product, but it reinforces the requirement for
explicit tie policies and R-oracle edge cases:
[jENA issue 1](https://github.com/HUDongpin/jENA/issues/1).

## 6. Target architecture

```text
Next.js App Router / React UI
        |
        v
Typed domain state and analysis specification
        |
        v
Worker supervisor: datasetHash + specHash + runId
        |
        +--> jENA numerical core
        +--> TypeScript inferential statistics
        +--> TypeScript trajectory/bootstrap/comparison
        |
        +--> Plotly 2D/3D specification compiler
        +--> CSV/ZIP/provenance exports

Development/CI only:
Frozen R/rENA oracle --> golden fixtures and parity reports

Optional server boundary:
Next.js AI route --> user-approved aggregate evidence only
```

Recommended source ownership:

- `apps/web` for the Next.js product;
- framework-independent packages for domain, jENA adapter, I/O, stats,
  trajectory, Plotly specs, exports, worker protocol, and parity contracts;
- R oracle scripts and legacy checkouts isolated from production artifacts.

Heavy computation should run in browser Web Workers so uploaded research data
can remain local and the product does not depend on a long-lived Shiny session.
If calibration demonstrates that required maximum workloads exceed supported
browser CPU/heap budgets, a persistent TypeScript/Node worker service requires a
separate approved architecture decision. Long computation must not be placed in
a short-lived Vercel request.

## 7. Scientific parity contract

“Same analysis effect” is defined as scientific and semantic equivalence under
an explicit versioned contract.

Required exact or structural checks include:

- unit count and typed unit identity;
- code/node and edge names and ordering;
- group levels and metadata alignment;
- window and accumulation semantics;
- line weights and adjacency;
- diagnostics, schema, and export columns;
- cohort membership and pairing identity;
- trajectory row meanings and display/export invariants.

Required numerical checks include:

- SVD sign alignment before ordinary coordinate comparison;
- subspace or Procrustes equivalence for degenerate SVDs;
- separately approved absolute and relative tolerances;
- eigenvalues, explained variance, centroids, networks, and invariants;
- Welch, rank-sum, signed-rank, effect, interval, and multiplicity results;
- step, cumulative distance, speed, bootstrap interval, and comparison results.

The contract must explicitly resolve:

- legacy rENA 0.2.7 versus jENA's rENA 0.3.1 reference;
- RNG, sampling, sorting, tie, zero, NA, and quantile behavior;
- fixed rotation versus refit policies in resampling;
- the accepted replacement for the legacy RDS-byte dataset hash;
- any intentional divergence from legacy behavior.

Golden files may not be updated solely to match new output. Each discrepancy
must be reproduced, explained, independently reviewed, and either fixed or
recorded as an approved versioned divergence.

## 8. Critical functional surface

### Data and model construction

- CSV, XLSX, XLS, and strict `.ena3d.json`;
- sheet selection, delimiter detection, preview, mapping, validation;
- one or more unit and conversation columns;
- at least three code columns and required unit/code constraints;
- unit-level metadata and primary group validation;
- EndPoint, AccumulatedTrajectory, SeparateTrajectory;
- Moving Stanza and Conversation windows;
- SVD and Means rotation;
- transactional activation after complete validation.

### Product views

- Overall;
- Networks;
- Comparison;
- Change;
- Trajectory;
- X/Y/Z dimensions, scale, edge width, grid, zero lines, axes, camera,
  fullscreen, and responsive resize;
- correct group means, confidence boxes, difference-network signs, nodes,
  line weights, hover, and legends.

### Statistics

- independent and paired study designs;
- Welch t-test;
- Wilcoxon rank-sum;
- paired signed-rank;
- alternatives, effect sizes, raw and adjusted p values, intervals where
  applicable, valid/dropped N, and matched/unmatched diagnostics;
- Holm, BH/FDR, Bonferroni, and none.

### Trajectory

- participant-period reduction;
- shared ENA rotation across periods;
- available and complete cohorts;
- missing policies and explicit order, including unobserved expected periods;
- selected/full-space distance, step, cumulative distance, elapsed time, speed;
- participant-cluster bootstrap with approved resampling policies;
- paired exact ID-time comparison;
- independent comparison if whole-repository scope requires it;
- 2D/3D paths, arrows, confidence boxes, network overlay, hover, diagnostics;
- path, uncertainty, comparison, metadata, diagnostics, manifest, and ZIP
  downloads.

### AI

AI remains optional and default-off until a separately verified gate passes.
The route may receive only the exact aggregate evidence envelope shown to and
approved by the user. No raw row, participant ID, participant trajectory, or
private context may be sent implicitly. Provider failure must not mutate the
active analysis.

## 9. Security and lifecycle boundary

- Preserve IDs larger than `2^53` without collision.
- Do not accept arbitrary R data/workspace uploads in the browser.
- Enforce input size, archive expansion, structure, depth, row, column, cell,
  node, and dimension limits before expensive work.
- Reject malformed or cross-table-inconsistent exchange documents.
- Keep active-dataset replacement transactional.
- Neutralize spreadsheet formula injection and handle irreversible CR/LF CSV
  cases explicitly.
- Bind every async result to immutable dataset/spec/run ownership.
- Timeout and cancel must terminate CPU work, not only reject a promise.
- Hold a capacity slot until termination is observed.
- Test maximum concurrency plus one, duplicate cancel, rapid restart, worker
  crash, page close, dataset replacement, and memory recovery.

## 10. License gate and current decision

The audited legacy repository is Apache-2.0, while `jena-js@0.6.2` declares
GPL-3.0-only. Removing the R/rENA runtime does not remove jENA's declared
license. Apache's documented compatibility is one-way for a combined GPLv3
work; see the
[Apache Software Foundation explanation](https://www.apache.org/licenses/GPL-compatibility.html).

Recorded direction and remaining review:

- the current root project now declares `GPL-3.0-only` in both `package.json`
  and `LICENSE`, so the working product direction is a GPLv3 distribution;
- before release, confirm that the repository contains the appropriate complete
  license text and third-party/dependency notices, and document the treatment
  of any legacy or rENA-derived material;
- any later Apache-only, dual-license, or proprietary direction requires an
  explicit reviewed successor decision rather than an incidental metadata edit.

The basic product-license direction is therefore recorded, but release-level
compliance remains a gate separate from numerical and technical tests.

## 11. Agent-native schedule

### Estimation model

- four concurrent Sol 5.6 Ultra agents;
- 24 continuous hours per natural day;
- one integration owner plus scientific, product/visual, and QA/release owners;
- average effective concurrency below four because of shared contracts,
  critical paths, real computations, builds, browsers, and soak;
- necessary owner decisions returned quickly;
- paused execution and external approval waiting excluded and reported
  separately.

### Active baseline

| Milestone | Incremental agent-hours P50 / P80 | Cumulative agent-hours P50 / P80 | Cumulative wall-clock P50 / P80 |
|---|---:|---:|---:|
| Calibration and trusted vertical slice | 120 / 190 | 120 / 190 | 2 / 4 natural days |
| Coherent internal beta | 400 / 570 | 520 / 760 | 7 / 12 natural days |
| Current public `/app` functional parity | 530 / 1,040 | 1,050 / 1,800 | 16 / 30 natural days |
| Public production replacement | 750 / 1,000 | 1,800 / 2,800 | 30 / 45 natural days |
| Strict whole-repository semantic parity | 700 / 1,400 | 2,500 / 4,200 | 45 / 70 natural days |

### Independent estimates and synthesis

Three Ultra-agent reviews produced different numbers because they estimated
different definitions of “done”:

- the jENA-focused implementation review estimated roughly 4.5 days P50 and
  10 days P80 for an evidence-backed analysis-package release candidate under a
  bounded scope;
- the full legacy-product review estimated roughly 16/23 days for public UI
  parity, 25/36 days for production closure, and 38/56 days for strict
  whole-repository parity;
- the strict architecture/release review estimated roughly 27/42 days for
  public analysis parity, 40/64 days for production, and 63/100 days for strict
  whole-repository closure.

The active table above deliberately separates early code/package completion
from public and production completion. Its P50 stays near the legacy-product
critical path, while its planning P80 retains additional integration and
release risk without treating the most conservative full-scope estimate as the
only possible outcome. If scope expands to every strict architecture gate, use
that review's upper range rather than silently holding the 45/70-day baseline.

If continuous execution begins on 2026-08-20, the corresponding approximate
dates are:

| Milestone | P50 | P80 |
|---|---:|---:|
| Calibration | 2026-08-22 | 2026-08-24 |
| Internal beta | 2026-08-27 | 2026-09-01 |
| Public functional parity | 2026-09-05 | 2026-09-19 |
| Production replacement | 2026-09-19 | 2026-10-04 |
| Strict whole-repository parity | 2026-10-04 | 2026-10-29 |

These are agent-native planning estimates, not promises that file generation is
equivalent to completion. Each milestone requires the corresponding evidence.

### Why the project is not a five-day production release

The main modules can plausibly exist in code after roughly 4.5 days P50 or
10 days P80. That is not the same as verified public parity or production
closure. The remaining time is dominated by:

- shared contract stabilization;
- R/jENA/TypeScript oracle comparison and mismatch diagnosis;
- statistical ties, zeros, missing data, and typed identities;
- trajectory cohort, bootstrap, pairing, and export interactions;
- true worker cancellation, memory, and stale-result behavior;
- cross-browser state and Plotly geometry;
- security and data limits;
- long-running tests, CI, preview deployment, soak, and exact-build evidence.

Unavoidable elapsed-time tests include full numerical matrices, repeated
bootstrap/permutation runs, browser suites, deployment cycles, a targeted
two-hour stress test, and at least one final extended soak. Other agents may work
in parallel, but the final passing run cannot be compressed to zero time.

### Schedule modifiers

- Development/validation R/rENA oracle: allowed and included in the baseline.
- Forbidding even a read-only oracle would add approximately 3–7 wall-clock
  days and weaken strict legacy-parity evidence.
- Requiring live Qwen at the public-parity milestone adds approximately 2–4
  days after credentials are available; external approval waiting is separate.
- Requiring strict R RNG/quantile parity adds approximately 2–5 days.
- Requiring legacy RDS-byte hashes adds approximately 1–3 days and may conflict
  with the pure-TypeScript objective; a successor hash is preferred.
- Requiring a persistent Node compute service after browser capacity failure
  adds approximately 6–14 days depending on the required queue/resume model.
- A material uncovered jENA-versus-rENA algorithm gap can add approximately
  5–9 days per major core issue.

## 12. Milestone definitions and evidence

### Calibration

Evidence required:

- frozen source/package/oracle versions;
- license decision recorded or explicitly open;
- converted trusted fixture provenance;
- canonical comparator and initial tolerance contract;
- Class 1 import to worker to jENA to shared 3D Plotly vertical slice;
- sign-aligned numerical report;
- real worker termination test;
- Next production build without an R production dependency.

If stable coordinates/weights cannot be reproduced by the P80 calibration
boundary, stop and re-estimate rather than hiding the risk behind UI work.

### Internal beta

Evidence required:

- a coherent real-browser analysis loop;
- principal data/model/view paths;
- basic statistics and centroid trajectory;
- progress, cancel, restart, and stale-result behavior;
- a deployable preview;
- an explicit, visible list of remaining parity gaps.

This milestone must not be called public parity.

### Current public functional parity

Evidence required:

- every current user-visible control and flow mapped and exercised;
- full raw/prepared input contract;
- all five model views and plot tools;
- full current Stats behavior;
- current UI trajectory, bootstrap, paired comparison, overlay, diagnostics, and
  formal downloads;
- four-sample R-versus-TypeScript parity manifest;
- real download inspection and browser evidence;
- AI evidence/default-off behavior matching the approved public scope.

This milestone does not automatically include every non-UI R API.

### Production replacement

Evidence required for the exact build:

- numerical and functional parity gates;
- parser and export security;
- worker termination, capacity, memory, and lifecycle gates;
- Chromium, Firefox, and WebKit across approved viewports;
- accessibility and reduced-motion gates;
- reference-device performance and long-run stress/soak;
- immutable build and health provenance;
- preview and public route/download acceptance;
- logging/privacy checks and rollback evidence;
- license strategy resolved.

### Strict whole-repository parity

Every intentional legacy API, diagnostic, schema, property test, offline tool,
AI evidence contract, and non-public analysis behavior must have one of:

- a verified TypeScript successor;
- a frozen compatibility artifact;
- an explicitly approved retirement/non-parity disposition.

This is stricter than replacing the current public website.

## 13. Open decisions

These questions remain unresolved unless a later record supersedes them:

1. Has the selected GPL-3.0-only distribution completed its full-license,
   dependency-notice, and derived-material compliance review?
2. Is the first release scoped to current public UI parity or strict whole-repo
   parity?
3. Is live Qwen required at first production release, or is verified default-off
   behavior sufficient?
4. Which rENA version defines legacy numerical authority where 0.2.7 and 0.3.1
   differ?
5. Which successor RNG, quantile, and provenance-hash contracts are approved?
6. What browser/device workload is mandatory, and what is the approved response
   if that budget exceeds browser capacity?
7. Will the reusable TypeScript analysis package be publicly published to npm
   in the first release?

## 14. Immediate next gate

The next implementation goal should be the 2–4 natural-day calibration, not a
claim of immediate full replacement. Its durable outputs should include:

- `PARITY_MATRIX.md`;
- `PARITY_CONTRACT_V1.md`;
- `DIVERGENCE_LEDGER.md`;
- a versioned fixture/provenance manifest;
- a Class 1 shared-SVD vertical slice;
- a worker cancellation receipt;
- a calibration report that either confirms or revises the remaining schedule.

No implementation status was claimed when this session record was created.

## 15. Primary references

- [3DENA repository](https://github.com/HUDongpin/3DENA)
- [Legacy baseline commit](https://github.com/HUDongpin/3DENA/commit/d02019ad872c5ece3840be2b4028ef27af38b2ff)
- [jENA repository](https://github.com/HUDongpin/jENA)
- [jENA baseline commit](https://github.com/HUDongpin/jENA/commit/2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3)
- [jena-js npm package](https://www.npmjs.com/package/jena-js)
- [3DENA trajectory specification](https://github.com/HUDongpin/3DENA/blob/d02019ad872c5ece3840be2b4028ef27af38b2ff/TRAJECTORY_ANALYSIS.md)
- [3DENA exchange specification](https://github.com/HUDongpin/3DENA/blob/d02019ad872c5ece3840be2b4028ef27af38b2ff/docs/ENA3D_EXCHANGE_V1.md)
- [3DENA AI interpretation specification](https://github.com/HUDongpin/3DENA/blob/d02019ad872c5ece3840be2b4028ef27af38b2ff/docs/AI_INTERPRETATION.md)
- [jENA numerical notes](https://github.com/HUDongpin/jENA/blob/2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3/NUMERICS.md)
- [jENA tied-data issue](https://github.com/HUDongpin/jENA/issues/1)
- [3DENA live health](https://www.3dena.com/ena3d-health/healthz.json)
- [OpenAI GPT-5.6 model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [Apache/GPL compatibility explanation](https://www.apache.org/licenses/GPL-compatibility.html)

## 16. Change protocol for this record

This file records the decisions and evidence available on 2026-08-20. Do not
rewrite historical observations to make later tests appear green. When a
decision changes, prefer a new dated successor record or append a clearly dated
supersession note that identifies:

- the old decision;
- the new decision;
- the approving owner;
- the evidence that motivated the change;
- the affected contract, schedule, and release gates.
