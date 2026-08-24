# Persistent TypeScript compute service v1

## Decision

Production Web analyses use a persistent Node.js/TypeScript service for ENA,
network Comparison, Change, Stats, trajectory, trajectory comparison, and
bootstrap. Browser Workers remain useful for exact-byte preflight, hashing,
lightweight inspection, development calibration, and SDK compatibility. They
are not the default production scientific authority.

This decision supersedes the earlier conditional Worker-first assumption. It
does not change the production runtime boundary: R, rENA, Shiny, R subprocesses,
and R-backed APIs remain prohibited.

## Runtime topology

- The compute API creates immutable jobs, issues short-lived capabilities,
  reports status/progress, and handles cancellation and deletion.
- PostgreSQL is the authoritative job-state, queue, lease, heartbeat, and
  compare-and-set publication store. Redis is not part of v1.
- An S3-compatible private object store holds encrypted immutable input and
  result objects.
- A persistent worker claims one leased job and starts one isolated Node child
  process for its scientific computation.
- A capacity slot is released only after child termination is observed.
- The Next.js application performs control-plane calls only; it never executes
  long scientific work inside a short-lived request handler.

## Ownership and state

Every job is bound to:

`datasetHash + specHash + runId + taskId + contractVersion`.

States are:

`CREATED → UPLOADED → QUEUED → RUNNING → SUCCEEDED|FAILED|CANCELLED → EXPIRED`,

with `CANCEL_REQUESTED` as an observable intermediate state. Claim, lease
renewal, result publication, cancellation, deletion, and expiry must be atomic
repository operations. An expired or replaced lease cannot publish a result.

Execution may retry from immutable input, but only the current lease can
compare-and-set the one published result. Duplicate create, execute, cancel,
and delete operations are deterministic and idempotent.

## Privacy and security

- The UI discloses server processing, region, retention, and deletion before
  every dataset upload.
- Raw input is deleted after a terminal result is stored and has a hard
  abnormal-job TTL of 24 hours.
- Result objects have a 24-hour hard TTL.
- Non-sensitive operational metadata has a seven-day maximum retention.
- Raw rows, participant identifiers, source file names, code content, and
  private research context are prohibited in logs, metrics, traces, URLs, and
  AI requests.
- Anonymous use is capability-scoped and rate/capacity limited. A capability is
  job-specific, short-lived, origin-bound, and never grants object-list access.
- Compute containers run non-root with a read-only root filesystem, explicit
  CPU/memory limits, and deny-by-default egress.

## Required implementation layers

1. A framework-independent state machine and storage/process interfaces.
2. PostgreSQL migrations and an atomic repository adapter.
3. S3-compatible immutable object and lifecycle adapter.
4. A compute API exposing create, execute, status, SSE, result, cancel/delete,
   health, readiness, and build identity.
5. A worker process with claim/heartbeat, isolated child execution, hard
   timeout/cancel, observed termination, and crash recovery.
6. A Web client using the same versioned contracts as the local SDK executor.

An in-memory adapter is test infrastructure only; its presence does not prove
PostgreSQL, S3, multi-process recovery, or production readiness.

## Local candidate checkpoint — 2026-08-21

Layers 1, the framework-neutral portion of layer 4, and the process-supervisor
slice of layer 5 now have local
`IMPLEMENTED_UNVERIFIED` candidates:

- `@3dena/compute-service-core` implements the state-machine-facing repository,
  immutable-object, process-supervisor, lease/fencing, cancellation,
  publication, deletion and TTL contracts with deterministic in-memory tests;
- `@3dena/compute-service-http` implements Web-standard `Request`/`Response`
  handlers for the v1 routes, strict CORS and contract negotiation,
  origin-bound HMAC capabilities, idempotency conflicts, SSE, result checksum
  verification and generic non-reflective errors;
- the HTTP integration tests drive these handlers with the public
  `createAnalysisClient()` rather than a test-only client dialect.
- `@3dena/compute-service-node` launches a fixed absolute Node entry with a
  versioned IPC-ready handshake, allowlisted environment, ignored stdio,
  abort/deadline handling, idempotent SIGTERM-to-SIGKILL termination and slot
  release only after the real child `close` event. Its fixed scientific child
  independently rehashes immutable input, calls the public analysis task
  executor, writes a checksum/owner/lease-bound result artifact, and exits zero
  only after a parent publication receipt acknowledges the lease-fenced CAS.
  Integration tests drive both the supervisor and this handshake through
  `ComputeServiceCore`.

This checkpoint does not implement layers 2 or 3, and does not complete layer
5: there is no PostgreSQL
migration/adapter, S3-compatible encrypted/lifecycle adapter, distributed
capacity coordinator, restart reattachment, acknowledgement replay, durable
orphan-result recovery, or hardened container. The executed scientific-child
matrix is still narrow and does not itself establish oracle parity. Its URL
issuer, repository and event broker remain test-only in-memory adapters; the
real Node supervisor is single-host and cannot reconcile children after a
service restart. Layer 6 is also incomplete because the public Web UI still
uses its calibration Workers rather than the remote client as the single
production authority.

## Acceptance

The lifecycle matrix must cover rapid cancel/restart, duplicate cancellation,
maximum concurrency plus one, timeout, child crash, API/worker restart, lease
expiry, late callback, stale result, page close, immutable dataset replacement,
TTL expiry, deletion receipt, and capacity release only after observed child
exit. Production logs must pass a raw-data leakage test.
