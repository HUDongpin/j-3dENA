# 2026-08-21 — Source-result derived-service vertical slice

## Status and lineage

Overall repository state remains `IMPLEMENTED_UNVERIFIED`.

This record describes the local worktree layered on pushed j-3dENA commit
`7b95aa7c9dff907486a83e8cac5ce7d6b0708dd4`. It is not a signed
`BuildApprovalV1`, preview receipt, production receipt, scientific parity
approval, or deployment authorization.

## Problem closed by this slice

Raw dataset activation is intentionally deleted after terminal ENA result
publication. The six derived task families nevertheless require the exact ENA
result as their immutable scientific source. Re-uploading raw rows, retaining
raw activation bytes, invoking a browser Worker in production, or accepting a
client-supplied result object would all violate the reviewed runtime boundary.

The successor flow therefore separates these capabilities:

1. a dataset capability authorizes tabular inventory, worksheet selection,
   mapping, preview, activation, and the initial ENA job;
2. the successful ENA job capability plus its canonical `resultHash`
   authorizes creation of one derived job;
3. the derived job receives its own capability and is bound to the exact
   source result, dataset receipt, compute build, owner, deadline, and task;
4. the service resolves the source result from service-owned immutable storage,
   verifies its canonical hash again, and constructs the worker input; and
5. the derived job is deleted after verified publication while the source ENA
   result remains available only until explicit session closure or TTL.

The build must advertise all of the following contracts before execution is
enabled:

- `3dena.compute-http.v1`;
- `3dena.compute-dataset-http.v1`;
- `3dena.compute-source-result-job-http.v1`; and
- `3dena.contract.v1`.

Missing the dataset contract disables upload. Missing the source-result job
contract leaves inspection available but disables all scientific execution.

## Scientific and ownership invariants

The source-result create request contains only:

- `sourceJobId`;
- canonical lowercase `sourceResultHash`; and
- explicit processing-policy confirmation.

It contains no raw rows, filename, mapping, activation token, result URL, or
result bytes. The service accepts it only when the source job is successful,
is an ENA job, has a valid activated-dataset receipt and owner, is authorized
by the exact source capability, is unexpired, belongs to the approved compute
build, and resolves to exact immutable bytes whose decoded result hashes to the
requested canonical result hash.

Every derived execute request is rejected when its source hash differs from
the job binding. Derived jobs cannot recursively become source jobs. Dataset,
specification, run, task, build, and source ownership remain independent
checks.

## Product surface

The production remote workspace now exposes all six derived task families
without a browser computation fallback:

- group network comparison with explicit A minus B direction;
- exact typed group or metadata-level network;
- independent or exact-ID/time paired statistics, alternatives, adjustment,
  retained-dimension selection, and paired-identity confirmation;
- trajectory dynamics with available versus complete cohorts, exactly three
  selected dimensions, separate selected/full-space distances, explicit
  ordered numeric/date/difftime contracts, and equal/metadata-weighted
  participant estimands;
- independent or confirmed-paired trajectory comparison with B minus A step
  semantics; and
- seeded complete-history cluster bootstrap with the public 200–500 replicate
  limit and pointwise linear Type-7 percentile intervals.

Instant and DST-fold time contracts remain fail-closed because the raw ENA
result does not preserve exact epoch, zone, offset, and fold provenance.
Civil dates are accepted only when `YYYY-MM-DD` parses and round-trips to the
same calendar date; normalized invalid dates such as 31 February are rejected.

Every derived result has a Plotly visualization, a keyboard-scrollable exact
table, diagnostics, and accessible summary text. Network charts show at most
the 30 largest absolute edges while their tables retain every edge in source
order. The production remote workspace disables the legacy browser-derived
panels.

## Formal export and deletion

The formal remote ZIP contains the exact verified source artifact bytes, exact
verified current-result artifact bytes, their result references, the active
dataset receipt, the active build approval object, a recomputed composite
provenance manifest, deterministic formal tables, and the manifest/ZIP hashes.
CSV cells continue to use the export package's formula-injection defenses.

Session closure first requires an observed dataset-workflow deletion receipt
and then an observed source-job deletion receipt. If workflow deletion is not
observed, the ENA source and UI retry action remain usable and source deletion
is not attempted. Replacement activation that has already deleted the prior
source reports that fact explicitly and never claims the old active dataset was
preserved.

## Local verification completed for this worktree

- root lint: pass for every workspace;
- root TypeScript checks: pass for every workspace;
- root tests: pass, including Web 100/100, analysis 91/91, HTTP 7/7, persistent
  21/21, IO 17/17, and all other workspace suites;
- Next.js 16.3.1 optimized `next build --webpack`: pass;
- production runtime-boundary unit contract: 13/13 pass;
- release-security unit contract: 10/10 pass;
- release-receipt unit contract: 3/3 pass;
- jENA successor unit contract: 3/3 pass;
- CI action-pin gate: pass;
- real Google Chrome remote-service E2E: 4/4 pass, including runtime identity,
  fail-closed contract negotiation, ENA source retention, one source-bound
  derived analysis, formal ZIP generation, deletion receipts, and the 375 px
  product surface;
- real Google Chrome raw/prepared Worker regression: 11/11 pass;
- real Google Chrome axe, keyboard, focus, responsive containment, and
  completed-result accessibility matrix: 22/22 pass;
- Playwright Firefox remote-service E2E: 4/4 pass;
- Playwright Firefox raw/prepared Worker regression: 11/11 pass;
- Playwright WebKit remote-service E2E: 4/4 pass;
- Playwright WebKit raw/prepared Worker regression: 11/11 pass; and
- `git diff --check`: pass.

These are local implementation receipts only. They do not establish remote CI,
preview, production, cloud deletion, stress, soak, browser, accessibility,
scientific-oracle, legal, or release acceptance.

## Gates deliberately still open

- `.ena3d.json` remains a separate prepared-source service contract. It may
  not be represented as raw ENA: its provenance must remain
  `sourceKind: prepared-exchange`, `jenaExecuted: false`, with an independent
  mapping, activation, registry, deletion, product, and export path.
- Playwright Firefox and WebKit runs are complete, but WebKit is not real
  Safari. Real Safari, VoiceOver, and NVDA remain separate.
- The exact signed preview/stress/soak/canary/production/rollback matrix has not
  run.
- Class 1 raw custody and the independently adjudicated 55-quantity three-oracle
  matrix remain absent.
- Public `jena-js@0.6.3`, independent reviewer approval, licensed/private-repo
  CodeQL eligibility, formal legal/DPA/region approval, and live cloud probes
  remain external gates.
